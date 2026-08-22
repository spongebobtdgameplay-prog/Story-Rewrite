let MultiplayerPolishFadeTimer = 0;
let MultiplayerPolishHideTimer = 0;

function ClearMultiplayerPolishTimers() {
    clearTimeout(MultiplayerPolishFadeTimer);
    clearTimeout(MultiplayerPolishHideTimer);
    MultiplayerPolishFadeTimer = 0;
    MultiplayerPolishHideTimer = 0;
}

function ScheduleMultiplayerStatusFade(Status, HideCallback) {
    if (!Status) return;

    ClearMultiplayerPolishTimers();
    Status.classList.remove("IsFading");

    MultiplayerPolishFadeTimer = setTimeout(() => {
        Status.classList.add("IsFading");
        MultiplayerPolishHideTimer = setTimeout(() => {
            HideCallback();
            Status.classList.remove("IsFading");
        }, 650);
    }, 1800);
}

const BaseShowLobbyStatusForPolish = ShowLobbyStatus;
ShowLobbyStatus = function(Text, Good) {
    BaseShowLobbyStatusForPolish(Text, Good);

    const Status = document.getElementById("LobbyStatus");
    if (!Status) return;

    Status.classList.remove("IsFading");
    ClearMultiplayerPolishTimers();

    if (Good === true) {
        ScheduleMultiplayerStatusFade(Status, () => HideLobbyStatus());
    }
};

const BaseHideLobbyStatusForPolish = HideLobbyStatus;
HideLobbyStatus = function() {
    ClearMultiplayerPolishTimers();
    const Status = document.getElementById("LobbyStatus");
    BaseHideLobbyStatusForPolish();
    Status?.classList.remove("IsFading");
};

const BaseShowRoomStatusForPolish = ShowRoomStatus;
ShowRoomStatus = function(Text, Good) {
    BaseShowRoomStatusForPolish(Text, Good);

    const Status = document.getElementById("RoomStatus") || document.getElementById("LobbyStatus");
    if (!Status) return;

    Status.classList.remove("IsFading");
    ClearMultiplayerPolishTimers();

    if (Good === true) {
        ScheduleMultiplayerStatusFade(Status, () => {
            if (Status.id === "RoomStatus") HideRoomStatus();
            else HideLobbyStatus();
        });
    }
};

const BaseHideRoomStatusForPolish = HideRoomStatus;
HideRoomStatus = function() {
    ClearMultiplayerPolishTimers();
    const Status = document.getElementById("RoomStatus");
    BaseHideRoomStatusForPolish();
    Status?.classList.remove("IsFading");
};
