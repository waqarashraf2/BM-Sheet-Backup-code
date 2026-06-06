<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Workaround for Cloudflare / cgi-fcgi stripping the Authorization header.
 *
 * The frontend sends the token in BOTH:
 *   Authorization: Bearer <token>
 *   X-Authorization: Bearer <token>
 *
 * If the standard header is missing (stripped by proxy/CDN), this middleware
 * copies X-Authorization into Authorization so Sanctum can authenticate normally.
 */
class ProxyAuthorizationHeader
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!$request->headers->has('Authorization') && $request->headers->has('X-Authorization')) {
            $request->headers->set('Authorization', $request->headers->get('X-Authorization'));
            $_SERVER['HTTP_AUTHORIZATION'] = $request->headers->get('X-Authorization');
        }

        return $next($request);
    }
}
