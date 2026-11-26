# Releases

Project documentation only; no formal OKF schema or certification is claimed.

Checks workflow jobs are **Web and database checks** and **Android credential-free build** for each customer/admin target, using standard Ubuntu runners with no application credentials. Android CI uses example package identities, not the production app registrations. No PR deploys or receives signing secrets. Dependabot opens review PRs without auto-merge. Tests and builds do not establish production service behavior or Play approval.

The manual **Protected Android signing** job is disabled until RELEASES_ENABLED is true. Configure the android-release GitHub environment with required human reviewers, prevent self-review, and restrict it to the protected default branch before setting RELEASE_ENVIRONMENT_CONFIGURED. Require completed latest-SHA independent review and CI before dispatch. The submitted reviewed_sha, checked-out HEAD and GitHub SHA must match. Operational attestations require real privacy, Data Safety, deletion, contact, device and backup/restore evidence, not merely setting flags.

Supply owner configuration from operations.md, an external upload keystore and increasing Android version code. Signing produces a bundle retained for three days; it does not submit it. Never upload private backups or credentials. The signing implementation requires a materialized keystore path, compares the upload-key certificate with ANDROID_UPLOAD_CERT_SHA256 before signing, and verifies the resulting bundle signature and signer certificate afterward. These safeguards have fixture coverage; actual JDK 21 signing, native builds, and device verification remain release blockers until exercised successfully.

`npm run play:publish` fails explicitly. Automated Play upload is not implemented. Complete initial app setup, legal declarations and first upload through Play Console. Production access and promotion remain owner-controlled in Console. Never bypass review or treat approval as automatic.

Any future API implementation must verify bundle identity/signature, inspect existing tracks without overwriting retained releases, validate edits, and commit with changesInReviewBehavior=ERROR_IF_IN_REVIEW rather than the cancellation default. Do not retry uncertain writes blindly. Use internal draft only until separately reviewed production automation is authorized.

Implementation references read on 2026-11-23: [Capacitor 8 migration](https://capacitorjs.com/docs/updating/8-0) specifies API 36; [Gradle 8.14.3 compatibility](https://docs.gradle.org/8.14.3/userguide/compatibility.html) excludes JDK 27; [Play edits](https://developers.google.com/android-publisher/edits) requires initial Console setup; [commit reference](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit) documents ERROR_IF_IN_REVIEW. Recheck Play policy before release rather than assuming API 36 remains sufficient forever.

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
