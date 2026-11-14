interface ImportMetaEnv {
  /** Design QA builds only (`VITE_AUTOPLAY=expert vite build --outDir <outside the package>`): a pilot plays real runs. */
  readonly VITE_AUTOPLAY?: string;
}
