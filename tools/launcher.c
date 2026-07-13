/* ============================================================
 * D&D 5e Studio, Windows launcher
 * ------------------------------------------------------------
 * Starts the local Node server (node server.js) in the folder of
 * the EXE and opens the browser. The Node process is assigned to
 * a job object with KILL_ON_JOB_CLOSE: as soon as this EXE ends
 * (window closed, Ctrl+C, task manager), Windows is guaranteed to
 * terminate the server as well, no zombie processes.
 *
 * Build (Linux cross-compile):
 *   x86_64-w64-mingw32-gcc -O2 -s -o "DnD5e-Studio.exe" launcher.c
 * Requirement on the target machine: Node.js in the PATH.
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

    /* working directory = folder of the EXE (where server.js lives) */
    char exePath[MAX_PATH];
    GetModuleFileNameA(NULL, exePath, MAX_PATH);
    char *slash = strrchr(exePath, '\\');
    if (slash) *slash = '\0';
    SetCurrentDirectoryA(exePath);

    /* does server.js exist? */
    if (GetFileAttributesA("server.js") == INVALID_FILE_ATTRIBUTES) {
        die("server.js nicht gefunden.\n\nDie EXE muss im Ordner 'dnd5e-studio' liegen\n(neben server.js).");
    }

    /* job object: children die with the launcher */
    HANDLE job = CreateJobObjectA(NULL, NULL);
    if (!job) die("Job-Objekt konnte nicht erstellt werden.");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = {0};
    jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));

    /* start the Node server (looks for node.exe in the PATH) */
    STARTUPINFOA si = { .cb = sizeof(si) };
    PROCESS_INFORMATION pi = {0};
    char cmd[] = "node server.js";           /* CreateProcess needs a writable buffer */
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

    /* give the server a moment, then open the browser */
    Sleep(1200);
    ShellExecuteA(NULL, "open", PORT_URL, NULL, NULL, SW_SHOWNORMAL);

    /* Wait until the server ends (or the user closes the window
     * -> process dies -> job kills Node). */
    WaitForSingleObject(pi.hProcess, INFINITE);
    CloseHandle(pi.hProcess);
    CloseHandle(job);
    return 0;
}
