import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * Shell JSON section (designer-2c.md §3.6, D8). Stateless: the store holds the text, any unapplied
 * edits and the note. Copy is handled here because it needs the textarea (to select the text when
 * the clipboard is blocked), and reports the outcome.
 */
@Component({
  selector: 'app-json-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="section-heading">
      <span>Shell JSON</span>
      <span class="flex gap-1.5">
        @if (hasEdits()) {
          <button
            type="button"
            class="btn btn-heading"
            data-testid="json-revert"
            (click)="revert.emit()"
          >
            Revert
          </button>
        }
        <button type="button" class="btn btn-heading" data-testid="json-copy" (click)="copy()">
          Copy
        </button>
        <button
          type="button"
          class="btn btn-heading"
          data-testid="json-apply"
          (click)="apply.emit()"
        >
          Apply
        </button>
      </span>
    </h2>
    <textarea
      #area
      class="field h-[180px] resize-y font-mono text-caption leading-[1.35]"
      spellcheck="false"
      aria-label="Shell JSON"
      aria-describedby="json-note"
      data-testid="json-text"
      [value]="text()"
      (input)="edit.emit($any($event.target).value)"
    ></textarea>
    <p class="note" id="json-note" aria-live="polite" data-testid="json-note">{{ note() }}</p>
  `,
})
export class JsonPanelComponent {
  readonly text = input.required<string>();
  readonly note = input.required<string>();
  readonly hasEdits = input(false);

  readonly edit = output<string>();
  readonly apply = output<void>();
  readonly revert = output<void>();
  /** True when the clipboard took the text; false when it was blocked (the text is then selected). */
  readonly copied = output<boolean>();

  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');

  protected async copy(): Promise<void> {
    const el = this.area().nativeElement;
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(el.value);
      this.copied.emit(true);
    } catch {
      el.focus();
      el.select();
      this.copied.emit(false);
    }
  }
}
