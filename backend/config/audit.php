<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Activity Logging
    |--------------------------------------------------------------------------
    |
    | Activity log writes are disabled by default. Set
    | AUDIT_LOGGING_ENABLED=true to resume inserting activity log records.
    |
    */
    'enabled' => env('AUDIT_LOGGING_ENABLED', false),
];
