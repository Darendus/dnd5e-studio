/* ============================================================
 * D&D 5e Studio, Windows-Launcher
 * ------------------------------------------------------------
 * Startet den lokalen Node-Server (node server.js) im Ordner der
 * EXE und öffnet den Browser. Der Node-Prozess wird einem Job-
 * Objekt mit KILL_ON_JOB_CLOSE zugewiesen: Sobald diese EXE endet
 * (Fenster schließen, Strg+C, Taskmanager), beendet Windows den
 * Server garantiert mit, keine Zombie-Prozesse.
 *
 * Build (Linux-Crosscompile):
 *   x86_64-w64-mingw32-gcc -O2 -s -o "DnD5e-Studio.exe" launcher.c
 * Voraussetzung auf dem Zielrechner: Node.js im PATH.
 * ============================================================ */
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>

#define PORT_URL "http://localhost:8420"

static void die(const char *msg) {
    MessageBoxA(NULL, msg, "D&D 5e Studio", MB_ICONERROR | MB_OK);
    ExitProcess(1);
}

int main(void) {
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleTitleA("D&D 5e Studio ,  Fenster schliessen beendet die App");

    /* Arbeitsverzeichnis = Ordner der EXE (dort liegt server.js) */
    char exePath[MAX_PATH];
    GetModuleFileNameA(NULL, exePath, MAX_PATH);
    char *slash = strrchr(exePath, '\\');
    if (slash) *slash = '\0';
    SetCurrentDirectoryA(exePath);

    /* server.js vorhanden? */
    if (GetFileAttributesA("server.js") == INVALID_FILE_ATTRIBUTES) {
        die("server.js nicht gefunden.\n\nDie EXE muss im Ordner 'dnd5e-studio' liegen\n(neben server.js).");
    }

    /* Job-Objekt: Kinder sterben mit dem Launcher */
    HANDLE job = CreateJobObjectA(NULL, NULL);
    if (!job) die("Job-Objekt konnte nicht erstellt werden.");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = {0};
    jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));

    /* Node-Server starten (sucht node.exe im PATH) */
    STARTUPINFOA si = { .cb = sizeof(si) };
    PROCESS_INFORMATION pi = {0};
    char cmd[] = "node server.js";           /* CreateProcess braucht schreibbaren Puffer */
    if (!CreateProcessA(NULL, cmd, NULL, NULL, FALSE,
                        CREATE_SUSPENDED | CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        die("Node.js wurde nicht gefunden.\n\nBitte Node.js installieren (https://nodejs.org)\nund sicherstellen, dass 'node' im PATH liegt.");
    }
    AssignProcessToJobObject(job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);

    printf("========================================\n");
    printf("  D&D 5e Studio laeuft.\n");
    printf("  Browser: %s\n", PORT_URL);
    printf("----------------------------------------\n");
    printf("  Dieses Fenster SCHLIESSEN beendet die\n");
    printf("  App vollstaendig (Server inklusive).\n");
    printf("========================================\n");

    /* Dem Server einen Moment geben, dann Browser oeffnen */
    Sleep(1200);
    ShellExecuteA(NULL, "open", PORT_URL, NULL, NULL, SW_SHOWNORMAL);

    /* Warten, bis der Server endet (oder der Nutzer das Fenster
     * schliesst -> Prozess stirbt -> Job killt Node). */
    WaitForSingleObject(pi.hProcess, INFINITE);
    CloseHandle(pi.hProcess);
    CloseHandle(job);
    return 0;
}
