# Chrome Web Store releases

Build the first Store upload with `bash scripts/package-chrome.sh` and upload `dist/arxiv-hop-chrome.zip` in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Use **Unlisted** visibility and publish the initial submission through the dashboard. Use the repository's [privacy policy](https://github.com/JeffryCA/arxiv-hop/blob/main/PRIVACY.md) in the listing.

The workflow uses a Google Cloud service account linked to the Store publisher. Enable `chromewebstore.googleapis.com`, `iamcredentials.googleapis.com`, and `sts.googleapis.com` in the service account's project. Configure [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) for GitHub Actions and grant `roles/iam.workloadIdentityUser` on the service account to the repository identity. Restrict the provider to the repository and owner IDs, the `push` event, and this workflow on `refs/tags/v*`. Add the service account in the [publisher dashboard](https://developer.chrome.com/docs/webstore/service-accounts).

Set these GitHub Actions repository variables once the first version is live:

- `CWS_WORKLOAD_IDENTITY_PROVIDER` with the full resource name, including the Google Cloud project number
- `CWS_SERVICE_ACCOUNT` with the service account email
- `CWS_ITEM_ID` with the extension's Store ID
- `CWS_PUBLISHER_ID` with the publisher ID from the dashboard. Set this last to enable submission.

To ship an update, bump `manifest.json` on `main`, then push a matching tag such as `v0.5.2`. The workflow tests, packages, and submits the version for review. Google publishes it after approval using the existing visibility. If an earlier version is in review, wait for it to clear before rerunning a failed submission. A manual workflow run builds a ZIP for inspection without submitting it.
