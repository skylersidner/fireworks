# Skill: Signal Forms custom controls (Angular 22.2)

**Domain:** Form controls bound with `[formField]` (designer rows now; Phase 5–6 forms)
**Confidence:** medium-high. Built and mutation-tested in 2c (`app/shared/range-row.ts`, `select-row.ts`; `app/shared/form-controls.spec.ts`).

## Contract
- Implement `FormValueControl<T>` from `@angular/forms/signals`. The only required member is `readonly value = model<T>()`. Optional inputs (`disabled`, `readonly`, `invalid`, `touched`, ...) are filled in from the field state automatically. Emit a `touch` output on blur.
- Bind with `<app-x [formField]="form.path" />`, importing `FormField`. Never use a ControlValueAccessor (OQ17); `designer-structure.spec.ts` greps for one.

## Reserved names (they bind from the field, not from you)
- `min`, `max`, `minLength`, `maxLength`, `name`, `required`, `pattern`, `disabled`, ... If you declare an input with one of these names, FormField overwrites it with the field's validator metadata (often `undefined`). Pass limits as a differently named input (range-row takes `range: NumericRange`).
- On a **native** element with `[formField]`, `[attr.maxlength]` (and the other managed attributes) is compile error **NG8022**. Put the rule in the schema instead (`maxLength(p.name, 80)`), and FormField writes the attribute.

## Patterns that worked
- **Native inside:** wrap a native `<input type="range">` or `<select>` and write `value.set(...)` on `input` (live) or `change`. Keyboard handling, screen-reader behavior and mobile pickers come free.
- **Select value:** set `[selected]` per `<option>` rather than `[value]` on the `<select>`. The select's value binding runs before `@for` renders the options.
- **Generic select:** `SelectRowComponent<T extends string>` with `model.required<T>()` type-checks against a `FieldTree<'a' | 'b'>`.
- **Conditional disable:** use `applyEach(p.items, (b) => disabled(b.x, ({ valueOf }) => valueOf(b.y) === 'none'))`. The control's `disabled` input follows it.
- **Don't fight the user:** keep the form's model raw, and derive the normalized value with a `linkedSignal` that holds the last good value. Never write the normalized value back into the model while the user is typing.

## Tests that must fail on a mutant
- The control writes its model on `input` or `change`, shows the model after an external `set`, and takes `disabled` from a schema rule (`form-controls.spec.ts`).
- Deleting the schema `disabled` rule fails both the store spec and the page spec (2c mutant C26).
