/**
 * Welcome to Cloudflare Pages Functions.
 *
 * This is a single file that acts as the backend for the Todo List app.
 * It's deployed as a Cloudflare Worker alongside the static site.
 *
 * - It uses a router to handle different API endpoints (/login, /todos, etc.).
 * - It authenticates users with a simple token stored in Cloudflare KV.
 * - It persists todo items in Cloudflare D1.
 *
 * Bindings (configured in Cloudflare Pages dashboard):
 * - `DB`: The D1 database instance.
 * - `TODO_SESSIONS`: The KV namespace for storing session tokens.
 */

// A simple router utility
const Router = () => {
    const routes = [];
    const add = (method, path, handler) => {
        routes.push({ method, path, handler });
    };
    const handler = async (request, env, ctx) => {
        const url = new URL(request.url);
        for (const route of routes) {
            // Match method
            if (request.method !== route.method) continue;

            // Match path using a simple pattern matcher
            const pattern = new RegExp(`^${route.path.replace(/:\w+/g, '([^/]+)')}$`);
            const match = url.pathname.match(pattern);
            
            if (match) {
                const params = {};
                const keys = (route.path.match(/:\w+/g) || []).map(key => key.substring(1));
                keys.forEach((key, i) => {
                    params[key] = match[i + 1];
                });
                
                return await route.handler({ request, env, ctx, params });
            }
        }
        return new Response('Not Found', { status: 404 });
    };
    return {
        get: (path, handler) => add('GET', path, handler),
        post: (path, handler) => add('POST', path, handler),
        put: (path, handler) => add('PUT', path, handler),
        delete: (path, handler) => add('DELETE', path, handler),
        handler,
    };
};

const router = Router();

// --- Middleware for Authentication ---

/**
 * Extracts the user email from the JWT-like token.
 * In a real app, you'd use a proper JWT library to verify the signature.
 * For this simple example, we just decode it.
 * @param {Request} request
 * @param {object} env - Cloudflare environment variables
 * @returns {string|null} User email or null if invalid
 */
async function authenticateUser(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7);
    
    // Validate token against KV store
    const userEmail = await env.TODO_SESSIONS.get(token);
    return userEmail || null;
}

// --- API Route Handlers ---

/**
 * POST /api/login
 * "Logs in" a user by creating a session token.
 */
router.post('/api/login', async ({ request, env }) => {
    const { email } = await request.json();
    if (!email) {
        return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Generate a simple, random token. In a real app, use a more secure method.
    const token = `token_${crypto.randomUUID()}`;

    // Store the email with the token as the key in KV. TTL of 1 week.
    await env.TODO_SESSIONS.put(token, email, { expirationTtl: 60 * 60 * 24 * 7 });

    return new Response(JSON.stringify({ token }), {
        headers: { 'Content-Type': 'application/json' },
    });
});

/**
 * GET /api/todos
 * Fetches all todos for the authenticated user.
 */
router.get('/api/todos', async ({ request, env }) => {
    const userEmail = await authenticateUser(request, env);
    if (!userEmail) {
        return new Response(JSON.stringify({ error: '认证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { results } = await env.DB.prepare(
        'SELECT id, content, completed, created_at FROM todos WHERE user_email = ?'
    ).bind(userEmail).all();
    
    return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json' },
    });
});

/**
 * POST /api/todos
 * Creates a new todo for the authenticated user.
 */
router.post('/api/todos', async ({ request, env }) => {
    const userEmail = await authenticateUser(request, env);
    if (!userEmail) {
        return new Response(JSON.stringify({ error: '认证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { content } = await request.json();
    if (!content) {
        return new Response(JSON.stringify({ error: 'Content is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const newTodo = {
        id: crypto.randomUUID(),
        user_email: userEmail,
        content: content,
    };

    await env.DB.prepare(
        'INSERT INTO todos (id, user_email, content) VALUES (?, ?, ?)'
    ).bind(newTodo.id, newTodo.user_email, newTodo.content).run();
    
    // Return the full new object so the frontend can add it
    const { results } = await env.DB.prepare('SELECT * FROM todos WHERE id = ?').bind(newTodo.id).all();

    return new Response(JSON.stringify(results[0]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
    });
});

/**
 * PUT /api/todos/:id
 * Updates a todo's completion status.
 */
router.put('/api/todos/:id', async ({ request, env, params }) => {
    const userEmail = await authenticateUser(request, env);
    if (!userEmail) {
        return new Response(JSON.stringify({ error: '认证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const { id } = params;
    const { completed } = await request.json();
    
    await env.DB.prepare(
        'UPDATE todos SET completed = ? WHERE id = ? AND user_email = ?'
    ).bind(completed ? 1 : 0, id, userEmail).run();

    return new Response(null, { status: 204 });
});


/**
 * DELETE /api/todos/:id
 * Deletes a todo.
 */
router.delete('/api/todos/:id', async ({ request, env, params }) => {
    const userEmail = await authenticateUser(request, env);
    if (!userEmail) {
        return new Response(JSON.stringify({ error: '认证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    const { id } = params;

    await env.DB.prepare(
        'DELETE FROM todos WHERE id = ? AND user_email = ?'
    ).bind(id, userEmail).run();

    return new Response(null, { status: 204 });
});


// --- Main Export ---
// This is the entry point for the Cloudflare Pages Function.
export async function onRequest(context) {
    // The `[[proxy]]` file route captures all requests to `/api/*`.
    return await router.handler(context.request, context.env, context);
}