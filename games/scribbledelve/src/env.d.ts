interface ImportMetaEnv {
  /** Design QA builds only (`VITE_AUTOPLAY=expert vite build --outDir dist-qa`): a pilot plays real runs at that skill. */
  readonly VITE_AUTOPLAY?: string;
}
