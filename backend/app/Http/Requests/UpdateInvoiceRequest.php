<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateInvoiceRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return in_array(auth()->user()->role, ['ceo', 'director', 'accounts_manager']);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'invoice_number' => ['sometimes', 'string', Rule::unique('invoices', 'invoice_number')->ignore($this->invoice)],
            'project_id' => 'sometimes|exists:projects,id',
            'month' => 'sometimes|integer|min:1|max:12',
            'year' => 'sometimes|integer|min:2020|max:2100',
            'service_counts' => 'sometimes|array',
            'total_amount' => 'nullable|numeric|min:0',
            'status' => 'sometimes|in:draft,pending_approval,approved,sent',
        ];
    }
}
