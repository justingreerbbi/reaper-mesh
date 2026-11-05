/** A simulated radio network (D50): holds no real keys and does no cryptography. */
export class SimulatedNetwork {
  mode = 1;
  generation = 0;
  epoch = 0;
  teamLoaded = false;
  /** The portal supplies the real calculation, so a simulated radio's fingerprints match. */
  fingerprint: (chain: string) => string = () => '0011223344556677';
  #relayChain = '';
  #teamChain = '';
  /** What firmware reports as its radio status reason, given its network. */
  get reason() {
    if (this.mode === 0) return 'network-not-chosen';
    return this.mode === 2 && !this.teamLoaded ? 'team-key-needed' : undefined;
  }
  /** Answers a network command the way firmware does, or undefined for any other message. */
  handle(message: Record<string, unknown> & { type: string; request?: unknown }) {
    let state = 'ok';
    if (message.type === 'networkFill') {
      const team = message.networkMode === 2;
      if (message.networkMode !== 1 && !team) state = 'invalid';
      else if (team && (!message.relayChain || !message.deviceKey || !message.generation))
        state = 'invalid';
      else {
        this.mode = Number(message.networkMode);
        this.generation = team ? Number(message.generation) : 0;
        this.epoch = team ? Number(message.epoch) : 0;
        this.teamLoaded = false;
        this.#relayChain = team ? String(message.relayChain) : '';
      }
    } else if (message.type === 'teamLoad') {
      if (this.mode !== 2) state = 'not-team';
      else if (message.generation !== this.generation || message.epoch !== this.epoch)
        state = 'mismatch';
      else {
        this.teamLoaded = true;
        this.#teamChain = String(message.teamChain);
      }
    } else if (message.type === 'networkErase') {
      this.mode = this.generation = this.epoch = 0;
      this.teamLoaded = false;
    } else if (message.type !== 'networkQuery') return undefined;
    return {
      type: 'networkStatus',
      request: message.request,
      state,
      networkMode: this.mode,
      generation: this.generation,
      epoch: this.epoch,
      teamLoaded: this.teamLoaded ? 1 : 0,
      ...(this.mode === 2 ? { relayFingerprint: this.fingerprint(this.#relayChain) } : {}),
      ...(this.teamLoaded ? { teamFingerprint: this.fingerprint(this.#teamChain) } : {}),
    };
  }
}
