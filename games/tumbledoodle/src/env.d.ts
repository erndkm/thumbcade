interface ImportMetaEnv {
  /** Design QA builds only (`VITE_AUTOPLAY=good vite build --outDir dist-qa`): the pilot plays real runs at that skill. */
  readonly VITE_AUTOPLAY?: string;
  /** QA builds only: "longest" puts the longest hint on every game-over card, to check its layout. */
  readonly VITE_QA_HINT?: string;
}
