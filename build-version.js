const STORY_BUILD_VERSION = "v2.41";

function ApplyStoryBuildVersion() {
    for (const Badge of document.querySelectorAll(".StoryBuildVersion")) {
        Badge.textContent = `Build ${STORY_BUILD_VERSION}`;
        Badge.title = `Loaded frontend version ${STORY_BUILD_VERSION}`;
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ApplyStoryBuildVersion, { once: true });
} else {
    ApplyStoryBuildVersion();
}
