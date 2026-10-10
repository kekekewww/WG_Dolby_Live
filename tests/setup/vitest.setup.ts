/**
 * Vitest setup (M1-PLAN section 7.1).
 *
 * jsdom implements neither HTMLDialogElement.showModal/show/close nor HTMLMediaElement playback;
 * its media stubs print "Not implemented" errors. These polyfills give components and the
 * coordinator safe defaults. Tests that care about the details replace them with
 * vi.spyOn(HTMLMediaElement.prototype, 'play') etc. (the properties are writable and configurable).
 *
 * Runs in every environment: tests marked `@vitest-environment node` skip the DOM parts.
 */

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype;

  const open = (dialog: HTMLDialogElement): void => {
    dialog.setAttribute('open', '');
  };

  define(proto, 'show', function show(this: HTMLDialogElement): void {
    if (this.hasAttribute('open')) return;
    open(this);
  });

  define(proto, 'showModal', function showModal(this: HTMLDialogElement): void {
    if (this.hasAttribute('open')) {
      throw new DOMException('The dialog is already open.', 'InvalidStateError');
    }
    if (!this.isConnected) {
      throw new DOMException('The dialog is not connected.', 'InvalidStateError');
    }
    open(this);
  });

  define(proto, 'close', function close(this: HTMLDialogElement, returnValue?: string): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  });
}

if (typeof HTMLMediaElement !== 'undefined') {
  const proto = HTMLMediaElement.prototype;
  define(proto, 'play', function play(): Promise<void> {
    return Promise.resolve();
  });
  define(proto, 'pause', function pause(): void {
    /* no-op */
  });
  define(proto, 'load', function load(): void {
    /* no-op */
  });
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  define(window, 'matchMedia', (query: string): MediaQueryList => {
    const list = {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
    return list as unknown as MediaQueryList;
  });
}
