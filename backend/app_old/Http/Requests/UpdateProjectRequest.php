<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProjectRequest extends FormRequest
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
            'code' => ['sometimes', 'string', 'max:50', Rule::unique('projects', 'code')->ignore($this->project)],
            'name' => 'sometimes|string|max:255',
            'country' => 'sometimes|string|max:50',
            'department' => 'sometimes|in:floor_plan,photos_enhancement',
            'client_name' => 'sometimes|string|max:255',
            'status' => 'sometimes|in:active,inactive,completed',
            'timezone' => 'nullable|string|max:50',
            'workflow_layers' => 'sometimes|array',
            'metadata' => 'sometimes|array',
        ];
    }
}
