import { h } from '../state.js';
import { field } from '../v4/ui.js';

export interface TextInputDialogOptions {
  title: string;
  label: string;
  value?: string;
  hint?: string;
  /** Label of the confirm button. */
  confirm: string;
  /** Further fields under the text field, read by submit. */
  extra?: HTMLElement[];
  /** Perform the write. Throw to keep the dialog open with the message and the typed value. */
  submit(value: string): Promise<void>;
}

let open: HTMLDialogElement | null = null;

/** Close the open dialog without writing anything, e.g. when the project closes. */
export function closeTextInputDialog(): void { open?.close(); }

/** In-Editor replacement for window.prompt, which the desktop app does not support. Cancel never writes. */
export function openTextInputDialog(options: TextInputDialogOptions): HTMLDialogElement {
  open?.close();
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = h('dialog', 'v4-insert-dialog text-input-dialog');
  dialog.setAttribute('aria-label', options.title);
  const form = h('form');
  const input = h('input');
  input.value = options.value ?? '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  form.append(h('h2', undefined, options.title), field(options.label, input), ...(options.extra ?? []));
  if (options.hint) form.append(h('p', 'text-input-dialog-hint', options.hint));
  const message = h('p', 'text-input-dialog-error');
  message.setAttribute('role', 'alert');
  message.hidden = true;
  const cancel = h('button', 'v4-button', '取消'); cancel.type = 'button';
  const confirm = h('button', 'v4-button v4-primary', options.confirm); confirm.type = 'submit';
  const footer = h('footer'); footer.append(cancel, confirm);
  form.append(message, footer);
  dialog.append(form);

  let busy = false;
  cancel.onclick = () => dialog.close();
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    confirm.disabled = true; cancel.disabled = true; input.readOnly = true;
    message.hidden = true;
    try {
      await options.submit(input.value);
      dialog.close();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
    } finally {
      busy = false;
      confirm.disabled = false; cancel.disabled = false; input.readOnly = false;
      if (dialog.open) input.focus();
    }
  };
  // Esc must not hide a write that is still running.
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (open === dialog) open = null;
    dialog.remove();
    if (returnFocus?.isConnected) returnFocus.focus();
  });
  document.body.append(dialog);
  open = dialog;
  dialog.showModal();
  input.focus();
  input.select();
  return dialog;
}
