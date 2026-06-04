<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * One-time cache-busting middleware.
 * 
 * Sends Clear-Site-Data: "cache" header on API responses
 * to force browsers to drop stale cached JS chunks when the
 * frontend is updated.
 * 
 * The header tells the browser: "clear your entire HTTP cache
 * for this origin" — causing it to re-fetch index.html and
 * all JS/CSS assets on the next navigation.
 */
class ClearBrowserCache
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Only add on HTTPS (Clear-Site-Data requires secure context)
        // and only for API requests
        if ($request->secure() || $request->header('X-Forwarded-Proto') === 'https') {
            $response->headers->set('Clear-Site-Data', '"cache"');
        }

        return $response;
    }
}
