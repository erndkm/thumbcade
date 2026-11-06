/* Picks the spot from ?spot= and exposes the frame API the renderer drives. */
(() => {
  const name = K.Q.get("spot");
  const make = (window.SPOTS || {})[name];
  if (!make) throw new Error(`unknown spot: ${name}`);
  const spot = make(K);
  let ready = false;
  window.AD = {
    W: K.W,
    H: K.H,
    FPS: K.FPS,
    DURATION: spot.DURATION,
    BLUR: spot.BLUR || [],
    async init() {
      await document.fonts.load('900 100px "Mona Sans"');
      await document.fonts.load('700 100px "Mona Sans"');
      await document.fonts.load('400 20px "Departure Mono"');
      await document.fonts.ready;
      if (spot.init) spot.init();
      ready = true;
    },
    async frame(t) {
      if (!ready) await this.init();
      spot.render(t);
      await K.settle();
      // Never screenshot an image that has not been decoded yet.
      for (let tries = 0; tries < 40; tries++) {
        const missing = [...K.stage.querySelectorAll("img")].filter((i) => i._src && i.offsetParent !== null && (!i.complete || i.naturalWidth === 0));
        if (!missing.length) break;
        for (const i of missing) {
          if (tries % 5 === 4) i.src = `${i._src}${i._src.includes("?") ? "&" : "?"}r=${tries}`;
          await i.decode().catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      const imgs = [...K.stage.querySelectorAll(".extra img")].filter((i) => !i.complete);
      await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    },
  };
})();
