export class MidiManager {
  private access: MIDIAccess | null = null;
  private changeListeners: Array<() => void> = [];

  static isSupported(): boolean {
    return 'requestMIDIAccess' in navigator;
  }

  async init(): Promise<void> {
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => {
      this.changeListeners.forEach(fn => fn());
    };
  }

  getOutputs(): MIDIOutput[] {
    if (!this.access) return [];
    const result: MIDIOutput[] = [];
    this.access.outputs.forEach(o => result.push(o));
    return result;
  }

  getOutputByName(name: string): MIDIOutput | null {
    if (!this.access) return null;
    for (const o of this.access.outputs.values()) {
      if (o.name === name) return o;
    }
    return null;
  }

  onStateChange(fn: () => void): void {
    this.changeListeners.push(fn);
  }
}
