interface ImportMetaEnv {
  /** QA builds only (`VITE_AUTOPLAY=good vite build --outDir dist-qa`): the pilot plays real runs at that skill. */
  readonly VITE_AUTOPLAY?: string;
  /** QA builds only: start the run this many seconds in (simulated headless by the pilot). */
  readonly VITE_WARP?: string;
}
