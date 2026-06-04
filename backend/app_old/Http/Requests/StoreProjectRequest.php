<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProjectRequest extends FormRequest
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
            'code' => 'required|string|max:50|unique:projects,code',
            'name' => 'required|string|max:255',
            'country' => 'required|string|max:50',
            'department' => 'required|in:floor_plan,photos_enhancement',
            'client_name' => 'required|string|max:255',
            'status' => 'sometimes|in:active,inactive,completed',
            'timezone' => 'nullable|string|max:50',
            'workflow_layers' => 'required|array',
            'metadata' => 'sometimes|array',
        ];
    }
}
