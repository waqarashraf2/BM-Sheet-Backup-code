<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateOrderRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return auth()->check();
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'order_number' => ['sometimes', 'string', Rule::unique('orders', 'order_number')->ignore($this->order)],
            'project_id' => 'sometimes|exists:projects,id',
            'client_reference' => 'nullable|string|max:255',
            'current_layer' => 'sometimes|in:drawer,checker,qa,designer',
            'status' => 'sometimes|in:pending,in-progress,completed,on-hold',
            'assigned_to' => 'nullable|exists:users,id',
            'team_id' => 'nullable|exists:teams,id',
            'priority' => 'sometimes|in:low,normal,high,urgent',
            'received_at' => 'sometimes|date',
            'started_at' => 'nullable|date',
            'completed_at' => 'nullable|date',
            'metadata' => 'sometimes|array',
        ];
    }
}
