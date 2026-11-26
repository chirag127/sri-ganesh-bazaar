# Sri Ganesh Bazaar

Bags-and-bulk storefront, quote-first customer ordering, and server-authorized shop operations. Money uses integer INR paise. Cash/manual UPI receipts require staff verification; the app does not calculate GST or claim tax exemption.

## Start locally

```sh
npm ci
npm run check
npm test
npm run test:db
npm run build
npx --no-install playwright install chromium
npm run test:e2e
npm run android:sync
npm run android:build
```

Unconfigured builds are illustrative and fail closed for protected actions. Android requires JDK 21 and SDK 36; a debug build is not a signed release. No deployment, DNS change, billing activation or Play approval is implied.

Read [setup](okf/setup.md), [architecture](okf/architecture.md), [operations](okf/operations.md), and [releases](okf/releases.md). These are project documents; no formal OKF schema or certification is claimed. Automated Play upload remains explicitly blocked pending implementation and verification.

**[chirag@oriz.in](mailto:chirag@oriz.in)**

<footer class="hire-me">
    <h3>Hire me</h3>
    <p>Chirag Singhal — building free, open APIs and tools.</p>
    <p>
        <a href="mailto:chirag@oriz.in">chirag@oriz.in</a> ·
        <a href="https://github.com/chirag127">GitHub</a> ·
        <a href="https://www.linkedin.com/in/chirag127/">LinkedIn</a> ·
        <a href="https://x.com/singhal127">X</a> ·
        <a href="https://www.youtube.com/@ChiragSinghal127">YouTube</a> ·
        <a href="https://www.instagram.com/chiragsinghal127/">Instagram</a> ·
        <a href="https://www.reddit.com/user/Far_Macaron_9910/">Reddit</a> ·
        <a href="https://buymeacoffee.com/chirag127">Buy me a coffee</a>
    </p>
</footer>
