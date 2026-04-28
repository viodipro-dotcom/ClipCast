import Link from "next/link";
import styles from "./page.module.css";

const LICENSE_URL =
  "https://github.com/viodipro-dotcom/ClipCast/blob/main/LICENSE";

export default function TermsPage() {
  return (
    <div className={styles.container}>
      <h1>Terms of Service</h1>
      <p className={styles.updated}>Last updated: 27 April 2026</p>

      <section className={styles.section}>
        <h2>1. Service description</h2>
        <p>
          ClipCast is a desktop application and companion website that helps creators import videos,
          generate AI metadata, and schedule or publish content to platforms such as YouTube,
          Instagram, and TikTok. The desktop app is{" "}
          <strong>open source</strong> and licensed under the MIT License (
          <a href={LICENSE_URL} rel="noopener noreferrer" target="_blank">
            see LICENSE in the repository
          </a>
          ). Use of the website and app is subject to these terms.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. Software and licence</h2>
        <p>
          You may use, modify, and distribute the software under the terms of the MIT License as
          published with the source code. The software is provided &quot;as is&quot;, without warranty of
          any kind, express or implied, to the extent permitted by applicable law.
        </p>
      </section>

      <section className={styles.section}>
        <h2>3. Third-party services</h2>
        <p>
          When you connect YouTube or other platforms, or configure optional providers such as OpenAI,
          those services process data under their own terms and privacy policies. You are responsible for
          complying with their rules and for keeping any API keys or credentials secure on your devices.
          ClipCast does not operate those providers on your behalf.
        </p>
      </section>

      <section className={styles.section}>
        <h2>4. Acceptable use</h2>
        <p>
          You must not use ClipCast to abuse, harass, or harm others, or for any unlawful purpose.
          You agree to comply with applicable laws and with the terms of any platform or API you use
          through the application.
        </p>
      </section>

      <section className={styles.section}>
        <h2>5. Disclaimer</h2>
        <p>
          To the fullest extent permitted by law, ClipCast and its contributors disclaim liability for
          indirect, incidental, or consequential damages arising from your use of the software or this
          website. We do not guarantee uninterrupted or error-free operation.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Contact</h2>
        <p>
          For questions about these terms, contact us at{" "}
          <a href="mailto:support@getclipcast.app">support@getclipcast.app</a>.
        </p>
      </section>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
