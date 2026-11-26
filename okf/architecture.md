# Architecture

Project documentation only; no formal OKF schema or certification is claimed.

Astro emits public indexable HTML; React islands provide customer and admin interfaces. Capacitor bundles the same dist output locally. Neon PostgreSQL owns transactional stock reservations, quotes and append-only financial history. The trusted commerce API verifies identity and binds it to each authorized database transaction. UI view switches never grant roles. Online quotes expire after 48 hours; acceptance rechecks stock atomically. Offline use is catalog/cart only, not orders or payments.

Static public catalog snapshots contain only published product details and availability, never prices. Approximate totals require an authenticated, shop-approved customer and are calculated by the server. Rebuild and republish snapshots after catalog changes; live application catalog reads do not update previously generated HTML. Never serialize customer histories, exact stock, purchase costs or payment evidence into static output. Illustrative data is not shop inventory.

Google identifies online customers through Neon Auth; native Android login remains unverified. Optional phone verification is distinct from staff confirmation and never implicitly links accounts by phone. Private object storage contains payment evidence. Admin Telegram alerts use a restricted worker and durable outbox; live scheduling and delivery require separate verification. Customer and admin Android build targets share application code and backend identity, but target configuration alone does not establish working native builds or login.

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
