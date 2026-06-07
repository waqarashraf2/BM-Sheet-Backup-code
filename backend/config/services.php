<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | External Portal (Captur3D / Roomio)
    |--------------------------------------------------------------------------
    | Credentials and config for the Roomio / Captur3D supplier portal.
    | These MUST live in a config file so they survive php artisan config:cache.
    */
    'external_portal' => [
        'username'  => env('EXTERNAL_PORTAL_USERNAME'),
        'password'  => env('EXTERNAL_PORTAL_PASSWORD'),
        'url'       => env('EXTERNAL_PORTAL_URL'),
        'start_url' => env('EXTERNAL_PORTAL_START_URL'),
    ],

    'roomio' => [
        'project_id'            => env('ROOMIO_PROJECT_ID', 15),
        'table'                 => env('ROOMIO_TABLE'),
        'pending_url'           => env('ROOMIO_PENDING_URL'),
        'processing_url'        => env('ROOMIO_PROCESSING_URL', ''),
        'api_token'             => env('ROOMIO_API_TOKEN'),
        'fetch_processing'      => env('ROOMIO_FETCH_PROCESSING', true),
        'variant_backfill_limit'=> env('ROOMIO_VARIANT_BACKFILL_LIMIT', 10),
        'import_start_date'     => env('ROOMIO_IMPORT_START_DATE'),
        'import_end_date'       => env('ROOMIO_IMPORT_END_DATE'),
        'order_details_url'     => env('ROOMIO_ORDER_DETAILS_URL_TEMPLATE', 'https://es-portal.captur3d.io/external_supplier/orders/{id}.json'),
    ],

];
