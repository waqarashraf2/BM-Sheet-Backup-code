<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return in_array(auth()->user()->role, ['ceo', 'director', 'operations_manager', 'project_manager']);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => 'sometimes|string|max:255',
            'email' => ['sometimes', 'email', Rule::unique('users', 'email')->ignore($this->user)],
            'password' => 'sometimes|string|min:8|confirmed',
            'role' => 'sometimes|in:ceo,director,operations_manager,project_manager,qa,live_qa,checker,filler,drawer,designer,accounts_manager',
            'country' => 'sometimes|string|max:255',
            'department' => 'sometimes|in:floor_plan,photos_enhancement',
            'project_id' => 'nullable|exists:projects,id',
            'team_id' => 'nullable|exists:teams,id',
            'layer' => 'nullable|in:drawer,checker,filler,qa,designer',
            'is_active' => 'sometimes|boolean',
            'wip_limit' => 'sometimes|integer|min:1|max:50',
            'skills' => 'sometimes|nullable|array',
            'skills.*' => 'string|max:100',
        ];
    }
}
