// API Response Utilities
// Provides consistent response patterns across all API endpoints

/**
 * Create a JSON response with the given data and status code.
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Create an error response with the given message and status code.
 */
export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Create a redirect response.
 */
export function redirectResponse(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { 'Location': url }
  });
}

/**
 * Standard error responses
 */
export const ApiErrors = {
  UNAUTHORIZED: () => errorResponse('Authentication required', 401),
  FORBIDDEN: () => errorResponse('Admin access required', 403),
  NOT_FOUND: (resource = 'Resource') => errorResponse(`${resource} not found`, 404),
  BAD_REQUEST: (message = 'Invalid request') => errorResponse(message, 400),
  INTERNAL: (message = 'An error occurred') => errorResponse(message, 500),
} as const;
