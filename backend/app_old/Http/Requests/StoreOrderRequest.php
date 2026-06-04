<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreOrderRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return in_array(auth()->user()->role, ['ceo', 'director', 'operations_manager']);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'order_number' => 'required|string|unique:orders,order_number',
            'project_id' => 'required|exists:projects,id',
            'client_reference' => 'nullable|string|max:255',
            'current_layer' => 'required|in:drawer,checker,qa,designer',
            'status' => 'sometimes|in:pending,in-progress,completed,on-hold',
            'assigned_to' => 'nullable|exists:users,id',
            'team_id' => 'nullable|exists:teams,id',
            'priority' => 'sometimes|in:low,normal,high,urgent',
            'received_at' => 'required|date',
            'metadata' => 'sometimes|array',
        ];
    }
}
