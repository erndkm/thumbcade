interface ImportMetaEnv {
  /** QA builds only (`VITE_AUTOPLAY=good vite build --outDir dist-qa`): the pilot plays real runs at that skill. */
  readonly VITE_AUTOPLAY?: string;
}
