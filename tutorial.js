document.addEventListener("DOMContentLoaded", () => {
    const Demo = document.getElementById("DemoSentence");
    Demo.addEventListener("click", () => Demo.classList.toggle("Crossed"));

    document.getElementById("StartButton").addEventListener("click", () => {
        Go("levels.html");
    });
});
