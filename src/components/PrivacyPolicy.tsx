export function PrivacyPolicy() {
  return (
    <main className="privacy-shell">
      <article className="privacy-page">
        <a className="privacy-back-link" href="/">
          Back to Pi Tiles
        </a>

        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Effective date: May 21, 2026</p>

        <p>
          PlayPiTiles is a Pi Network arcade game available at play-pi-tiles.com. This Privacy
          Policy explains what information the app processes, why it is processed, and the choices
          available to players.
        </p>

        <h2>Information We Collect</h2>
        <p>
          When you sign in with Pi, the app requests the Pi username scope. The Pi SDK may return
          your Pi username, Pi user identifier, and an access token. The access token is sent to our
          backend only so it can verify your Pi account with Pi Network.
        </p>
        <p>
          When you make a Pi payment, the app and backend may process payment identifiers,
          transaction identifiers, payment status, and related metadata needed to approve and
          complete the payment through Pi Network.
        </p>
        <p>
          When you play the game or submit a score, the app may process gameplay information such as
          score, valid moves, VIP status, leaderboard display name, week label, timestamp, and a
          board hash used for basic anti-cheat checks.
        </p>
        <p>
          Like most hosted apps, our infrastructure may process technical information such as IP
          address, browser type, device information, request URLs, timestamps, and error logs for
          security, debugging, and service reliability.
        </p>

        <h2>How We Use Information</h2>
        <p>We use the information described above to:</p>
        <ul>
          <li>Authenticate players with Pi Network.</li>
          <li>Approve, complete, and troubleshoot Pi payments.</li>
          <li>Display your Pi username and leaderboard entries.</li>
          <li>Protect gameplay integrity and reduce fraud or abuse.</li>
          <li>Operate, secure, debug, and improve the app.</li>
        </ul>

        <h2>Pi Network Authentication and Payments</h2>
        <p>
          Pi authentication is validated server-side by calling Pi Network&apos;s user verification
          endpoint. Pi payment approval and completion are handled server-side through Pi Network
          payment APIs. We do not ask for, collect, or store your Pi wallet passphrase or private
          keys.
        </p>

        <h2>Cookies and Sessions</h2>
        <p>
          After successful Pi authentication, the backend may set a secure session cookie. This
          cookie is used to maintain an authenticated session and is not used for advertising.
        </p>

        <h2>Sharing of Information</h2>
        <p>
          We do not sell personal information. We may share or process information with service
          providers only as needed to run the app, including Pi Network for authentication and
          payments, and Cloudflare for hosting, security, and delivery.
        </p>

        <h2>Data Retention</h2>
        <p>
          We keep information only for as long as reasonably necessary to operate the app, maintain
          payment records, protect the service, comply with legal obligations, and resolve disputes.
          Session cookies expire automatically.
        </p>

        <h2>Security</h2>
        <p>
          We use reasonable technical and organizational measures to protect the app and its
          backend. No internet service can be guaranteed to be completely secure, so players should
          also protect their own Pi account and device.
        </p>

        <h2>Your Choices</h2>
        <p>
          You can choose not to sign in with Pi and use guest mode where available. You can also
          decline or cancel Pi payment flows. Browser settings may allow you to clear cookies or
          site data.
        </p>

        <h2>Children&apos;s Privacy</h2>
        <p>
          PlayPiTiles is not intended for children under the age required to use Pi Network or under
          the age of digital consent in their jurisdiction. We do not knowingly collect information
          from children.
        </p>

        <h2>International Processing</h2>
        <p>
          The app may be accessed globally, and information may be processed in countries where our
          hosting, infrastructure, and service providers operate.
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The updated version will be posted on
          this page with a new effective date.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy questions about PlayPiTiles, contact the app developer through the official Pi
          Network app listing or the project repository associated with this app.
        </p>
      </article>
    </main>
  )
}
