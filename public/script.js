document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素 ---
    const loginScreen = document.getElementById('login-screen');
    const todoApp = document.getElementById('todo-app');
    const emailInput = document.getElementById('email-input');
    const loginBtn = document.getElementById('login-btn');
    const userEmailDisplay = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');
    const newTodoForm = document.getElementById('new-todo-form');
    const newTodoInput = document.getElementById('new-todo-input');
    const todoList = document.getElementById('todo-list');

    // --- API 请求封装 ---
    const api = {
        // 封装的 fetch 函数，自动处理认证和 JSON
        async request(endpoint, options = {}) {
            const token = localStorage.getItem('todo_token');
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers,
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`/api${endpoint}`, { ...options, headers });

            if (!response.ok) {
                const error = await response.json();
                alert(`错误: ${error.error}`);
                throw new Error(error.error);
            }
            // 某些请求可能没有 body (e.g., 204 No Content)
            if (response.status === 204) {
                return;
            }
            return response.json();
        },

        // 登录
        login(email) {
            return this.request('/login', {
                method: 'POST',
                body: JSON.stringify({ email }),
            });
        },
        
        // 获取所有 todos
        getTodos() {
            return this.request('/todos');
        },

        // 创建一个 todo
        createTodo(content) {
            return this.request('/todos', {
                method: 'POST',
                body: JSON.stringify({ content }),
            });
        },

        // 更新一个 todo
        updateTodo(id, completed) {
            return this.request(`/todos/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ completed }),
            });
        },

        // 删除一个 todo
        deleteTodo(id) {
            return this.request(`/todos/${id}`, {
                method: 'DELETE',
            });
        },
    };

    // --- UI 渲染函数 ---

    /**
     * 根据 todo 数据创建并返回一个列表项元素
     * @param {object} todo - The todo object ({ id, content, completed })
     * @returns {HTMLLIElement}
     */
    function createTodoElement(todo) {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
        li.dataset.id = todo.id;

        li.innerHTML = `
            <div class="checkbox"></div>
            <span class="content">${escapeHTML(todo.content)}</span>
            <button class="delete-btn">×</button>
        `;

        // 添加事件监听器
        li.querySelector('.checkbox').addEventListener('click', () => toggleTodoCompletion(todo.id, !todo.completed));
        li.querySelector('.delete-btn').addEventListener('click', () => deleteTodoItem(todo.id));

        return li;
    }
    
    /**
     * 渲染整个 todo 列表
     * @param {array} todos - Array of todo objects
     */
    function renderTodos(todos) {
        todoList.innerHTML = '';
        todos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
             .forEach(todo => {
                todoList.appendChild(createTodoElement(todo));
             });
    }

    // --- 业务逻辑和事件处理 ---

    /**
     * 切换 UI 视图（登录/主应用）
     * @param {boolean} isLoggedIn - Whether the user is logged in
     */
    function setLoginView(isLoggedIn) {
        if (isLoggedIn) {
            loginScreen.classList.add('hidden');
            todoApp.classList.remove('hidden');
            userEmailDisplay.textContent = localStorage.getItem('user_email');
            loadTodos();
        } else {
            loginScreen.classList.remove('hidden');
            todoApp.classList.add('hidden');
            localStorage.removeItem('todo_token');
            localStorage.removeItem('user_email');
        }
    }

    /**
     * 处理登录逻辑
     */
    async function handleLogin() {
        const email = emailInput.value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
            alert('请输入有效的邮箱地址。');
            return;
        }

        try {
            const data = await api.login(email);
            localStorage.setItem('todo_token', data.token);
            localStorage.setItem('user_email', email);
            setLoginView(true);
        } catch (error) {
            console.error('登录失败:', error);
        }
    }

    /**
     * 处理登出逻辑
     */
    function handleLogout() {
        setLoginView(false);
    }

    /**
     * 从后端加载并渲染 todos
     */
    async function loadTodos() {
        try {
            const todos = await api.getTodos();
            renderTodos(todos);
        } catch (error) {
            console.error('加载 todos 失败:', error);
            // 如果因为认证失败，则登出
            if(error.message.includes('认证失败')) {
                handleLogout();
            }
        }
    }

    /**
     * 处理新增 todo 的表单提交
     * @param {Event} e 
     */
    async function handleAddTodo(e) {
        e.preventDefault();
        const content = newTodoInput.value.trim();
        if (content) {
            try {
                const newTodo = await api.createTodo(content);
                todoList.appendChild(createTodoElement(newTodo));
                newTodoInput.value = '';
            } catch (error) {
                console.error('创建 todo 失败:', error);
            }
        }
    }
    
    /**
     * 切换 todo 的完成状态
     * @param {string} id - The ID of the todo
     * @param {boolean} completed - The new completion status
     */
    async function toggleTodoCompletion(id, completed) {
        try {
            await api.updateTodo(id, completed);
            const item = todoList.querySelector(`[data-id="${id}"]`);
            if (item) {
                item.classList.toggle('completed', completed);
                // 更新 DOM 元素的 completed 状态，以便重新切换时使用
                const checkbox = item.querySelector('.checkbox');
                checkbox.onclick = () => toggleTodoCompletion(id, !completed);
            }
        } catch (error) {
            console.error('更新 todo 失败:', error);
        }
    }

    /**
     * 删除一个 todo 项
     * @param {string} id - The ID of the todo to delete
     */
    async function deleteTodoItem(id) {
        if (confirm('确定要删除这项待办吗？')) {
            try {
                await api.deleteTodo(id);
                const item = todoList.querySelector(`[data-id="${id}"]`);
                if (item) {
                    item.remove();
                }
            } catch (error) {
                console.error('删除 todo 失败:', error);
            }
        }
    }

    /**
     * 防御 XSS 的简单 HTML 转义函数
     * @param {string} str 
     * @returns {string}
     */
    function escapeHTML(str) {
        return str.replace(/[&<>"']/g, function (match) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[match];
        });
    }

    // --- 初始化 ---
    function init() {
        loginBtn.addEventListener('click', handleLogin);
        emailInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        logoutBtn.addEventListener('click', handleLogout);
        newTodoForm.addEventListener('submit', handleAddTodo);

        // 检查是否存在 token，如果存在则直接显示应用界面
        if (localStorage.getItem('todo_token')) {
            setLoginView(true);
        } else {
            setLoginView(false);
        }
    }

    init();
});