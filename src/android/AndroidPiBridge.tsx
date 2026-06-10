const PI_BROWSER_URL = 'pi://play-pi-tiles.com'

export function AndroidPiBridge() {
  return (
    <section className="panel panel-amber android-pi-bridge">
      <div className="panel-title-row">
        <div className="panel-title">
          <span className="pi-icon tone-cyan" aria-hidden="true">
            ✦
          </span>
          <h2>Earn Pi rewards</h2>
        </div>

        <span className="pi-bridge-badge">Pi Browser</span>
      </div>

      <p>Play as a guest on Android. Unlock Pi rewards, VIP access and Pioneer features in Pi Browser.</p>

      <a className="pi-browser-launch" href={PI_BROWSER_URL}>
        Open PlayPiTiles in Pi Browser
      </a>
    </section>
  )
}
