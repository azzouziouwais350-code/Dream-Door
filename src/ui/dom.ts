type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  html?: never;
  title?: string;
  type?: string;
  disabled?: boolean;
  tabindex?: number;
  role?: string;
  ariaLabel?: string;
  ariaLive?: 'polite' | 'assertive' | 'off';
  src?: string;
  alt?: string;
  value?: string;
  min?: number;
  max?: number;
  step?: number;
  checked?: boolean;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  data?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

/** Fabrique DOM minimale. Aucun innerHTML : tout le texte passe par textContent (pas d'injection possible). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.type) (el as unknown as HTMLInputElement).type = props.type;
  if (props.disabled !== undefined) (el as unknown as HTMLButtonElement).disabled = props.disabled;
  if (props.tabindex !== undefined) el.tabIndex = props.tabindex;
  if (props.role) el.setAttribute('role', props.role);
  if (props.ariaLabel) el.setAttribute('aria-label', props.ariaLabel);
  if (props.ariaLive) el.setAttribute('aria-live', props.ariaLive);
  if (props.src) (el as unknown as HTMLImageElement).src = props.src;
  if (props.alt !== undefined) (el as unknown as HTMLImageElement).alt = props.alt;
  if (props.value !== undefined) (el as unknown as HTMLInputElement).value = props.value;
  if (props.min !== undefined) (el as unknown as HTMLInputElement).min = String(props.min);
  if (props.max !== undefined) (el as unknown as HTMLInputElement).max = String(props.max);
  if (props.step !== undefined) (el as unknown as HTMLInputElement).step = String(props.step);
  if (props.checked !== undefined) (el as unknown as HTMLInputElement).checked = props.checked;
  if (props.style) Object.assign(el.style, props.style);
  if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = v;
  if (props.on) {
    for (const [ev, fn] of Object.entries(props.on)) {
      if (fn) el.addEventListener(ev, fn as EventListener);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const hrs = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hrs > 0 ? `${hrs} h ${mm} min` : `${mm}:${ss}`;
}
