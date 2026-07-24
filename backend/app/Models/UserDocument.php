<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserDocument extends Model
{
    public const TYPE_COPY_OF_CNIC = 'copy_of_cnic';
    public const TYPE_TWO_PICS = 'two_pics';
    public const TYPE_NDA = 'nda';
    public const TYPE_CONTRACT_LETTER = 'contract_letter';
    public const TYPE_EXTRA = 'extra';

    public const TYPES = [
        self::TYPE_COPY_OF_CNIC,
        self::TYPE_TWO_PICS,
        self::TYPE_NDA,
        self::TYPE_CONTRACT_LETTER,
        self::TYPE_EXTRA,
    ];

    protected $fillable = [
        'user_id',
        'machine_id',
        'document_type',
        'original_name',
        'file_name',
        'file_path',
        'mime_type',
        'file_size',
        'uploaded_by',
        'uploaded_at',
    ];

    protected $casts = [
        'uploaded_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
