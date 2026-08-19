if (typeof StoryAudio !== "undefined" && StoryAudio?.PlaySound && !StoryAudio.PlaySound.V11Wrapped) {
    const BasePlaySound = StoryAudio.PlaySound.bind(StoryAudio);

    const WrappedPlaySound = function(Name) {
        switch (Name) {
            case "vote":
                BasePlaySound("click");
                setTimeout(() => BasePlaySound("ready"), 35);
                return;

            case "revive":
                BasePlaySound("ready");
                setTimeout(() => BasePlaySound("success"), 90);
                return;

            case "reviveEarned":
                BasePlaySound("success");
                setTimeout(() => BasePlaySound("message"), 130);
                return;

            case "heartRefill":
                BasePlaySound("restore");
                setTimeout(() => BasePlaySound("success"), 110);
                return;

            default:
                BasePlaySound(Name);
        }
    };

    WrappedPlaySound.V11Wrapped = true;
    StoryAudio.PlaySound = WrappedPlaySound;
}
