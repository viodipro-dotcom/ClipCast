type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
  content_type?: string;
};

type GithubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: GithubReleaseAsset[];
};

export type ReleaseInfo = {
  version?: string;
  releaseUrl: string;
  installerUrl?: string;
  assetName?: string;
};

/** GitHub repo where installers are published (same as electron-builder `build.publish`). Not ClipCast-Releases. */
const OWNER = process.env.NEXT_PUBLIC_GITHUB_RELEASE_OWNER ?? "viodipro-dotcom";
const REPO = process.env.NEXT_PUBLIC_GITHUB_RELEASE_REPO ?? "ClipCast";
const BASE_URL = `https://github.com/${OWNER}/${REPO}`;
const GITHUB_API_LATEST_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

/** Display slug for UI copy (e.g. download fallback note). */
export const GITHUB_RELEASE_REPO_SLUG = `${OWNER}/${REPO}`;

export const RELEASES_PAGE_URL = `${BASE_URL}/releases`;
export const LATEST_RELEASE_URL = `${BASE_URL}/releases/latest`;

const EXE_REGEX = /\.exe$/i;

function normalizeVersion(tag?: string): string | undefined {
  if (!tag) return undefined;
  return tag.startsWith("v") ? tag : `v${tag}`;
}

function selectWindowsInstaller(
  assets: GithubReleaseAsset[] | undefined,
): GithubReleaseAsset | undefined {
  if (!assets?.length) return undefined;
  const exeAsset = assets.find((asset) => EXE_REGEX.test(asset.name));
  if (exeAsset) return exeAsset;
  return assets.find((asset) => asset.content_type === "application/x-msdownload");
}

export async function getLatestReleaseInfo(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(GITHUB_API_LATEST_URL, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GithubRelease;
    const releaseUrl = data.html_url ?? LATEST_RELEASE_URL;
    const version = normalizeVersion(data.tag_name ?? data.name);
    const installerAsset = selectWindowsInstaller(data.assets);

    return {
      version,
      releaseUrl,
      installerUrl: installerAsset?.browser_download_url,
      assetName: installerAsset?.name,
    };
  } catch {
    return null;
  }
}
