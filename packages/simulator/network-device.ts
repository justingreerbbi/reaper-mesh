/** A simulated radio network (D50, D52): holds no real keys and does no cryptography. */
export class SimulatedNetwork {
  mode = 1;
  generation = 0;
  /** The floor: the oldest epoch this radio still accepts, and the one its relay key is at. */
  floor = 0;
  provenEpoch = 0;
  teamEpoch = 0;
  teamLoaded = false;
  /** The portal supplies the real calculation, so a simulated radio's fingerprints match. */
  fingerprint: (chain: string) => string = () => '0011223344556677';
  #relayChain = '';
  #teamChain = '';
  #proof = '';
  /** What firmware reports as its epoch: the team key's, or the floor without one. */
  get epoch() {
    return this.teamLoaded ? this.teamEpoch : this.floor;
  }
  /** Replaces the check firmware does, for a portal that wants a wrong proof refused. */
  validProof: (epoch: number, proof: string, known: string, steps: number) => boolean = () => true;
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
      else if (
        team &&
        (!message.relayChain || !message.deviceKey || !message.generation || !message.proof)
      )
        state = 'invalid';
      else {
        this.mode = Number(message.networkMode);
        this.generation = team ? Number(message.generation) : 0;
        this.floor = this.provenEpoch = team ? Number(message.epoch) : 0;
        this.teamLoaded = false;
        this.#relayChain = team ? String(message.relayChain) : '';
        this.#proof = team ? String(message.proof) : '';
      }
    } else if (message.type === 'teamLoad') {
      if (this.mode !== 2) state = 'not-team';
      else if (
        message.generation !== this.generation ||
        Number(message.epoch) < this.floor ||
        Number(message.epoch) > this.floor + 1024
      )
        state = 'mismatch';
      else {
        this.teamLoaded = true;
        this.teamEpoch = Number(message.epoch);
        this.#teamChain = String(message.teamChain);
      }
    } else if (message.type === 'networkAdvance') {
      const epoch = Number(message.epoch),
        proof = String(message.proof);
      if (this.mode !== 2) state = 'not-team';
      else if (epoch < this.provenEpoch) state = 'mismatch';
      else if (epoch === this.provenEpoch) state = proof === this.#proof ? 'ok' : 'invalid';
      else if (
        epoch - this.provenEpoch > 1024 ||
        !this.validProof(epoch, proof, this.#proof, epoch - this.provenEpoch)
      )
        state = 'invalid';
      else {
        this.floor = epoch - 1;
        this.provenEpoch = epoch;
        this.#proof = proof;
        this.teamEpoch = Math.max(this.teamEpoch, epoch);
      }
    } else if (message.type === 'networkErase') {
      this.mode = this.generation = this.floor = this.provenEpoch = this.teamEpoch = 0;
      this.teamLoaded = false;
      this.#proof = '';
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
      ...(this.mode === 2 ? { provenEpoch: this.provenEpoch, proof: this.#proof } : {}),
    };
  }
}
