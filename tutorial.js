document.addEventListener("DOMContentLoaded", () => {
    const Demo = document.getElementById("DemoSentence");
    const CategoryButtons = [...document.querySelectorAll("[data-tutorial-category]")];
    const CategoryPanels = [...document.querySelectorAll("[data-tutorial-panel]")];

    Demo?.addEventListener("click", () => Demo.classList.toggle("Crossed"));

    function SetCategory(Category) {
        for (const Button of CategoryButtons) {
            const Active = Button.dataset.tutorialCategory === Category;
            Button.classList.toggle("Active", Active);
            Button.setAttribute("aria-selected", String(Active));
        }

        for (const Panel of CategoryPanels) {
            Panel.hidden = Panel.dataset.tutorialPanel !== Category;
        }
    }

    for (const Button of CategoryButtons) {
        Button.addEventListener("click", () => SetCategory(Button.dataset.tutorialCategory));
    }

    document.getElementById("StartButton")?.addEventListener("click", () => Go("levels.html"));
    document.getElementById("MultiplayerButton")?.addEventListener("click", () => Go("multiplayer.html"));

    SetCategory("single");
});
