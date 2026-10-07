export const FORM_FIELD_A11Y_CONTEXT = Symbol('lv-form-field-a11y');

export interface FormFieldA11yContext {
    labelId: string;
    descriptionId: string;
}

let nextFormFieldId = 0;

export function createFormFieldA11yContext(): FormFieldA11yContext {
    const baseId = `lv-form-field-${++nextFormFieldId}`;
    return {
        labelId: `${baseId}-title`,
        descriptionId: `${baseId}-description`
    };
}
