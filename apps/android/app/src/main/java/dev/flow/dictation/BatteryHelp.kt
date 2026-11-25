package dev.flow.dictation

/** Plain-language steps to stop a phone's battery manager from closing the floating mic. */
object BatteryHelp {
    /** The phone maker's name as Android reports it, lower-cased, mapped to a short key. */
    fun brand(manufacturer: String): String = when (manufacturer.trim().lowercase()) {
        "vivo", "iqoo" -> "vivo"
        "xiaomi", "redmi", "poco" -> "xiaomi"
        "oppo", "realme", "oneplus" -> "oppo"
        "samsung" -> "samsung"
        "huawei", "honor" -> "huawei"
        else -> "other"
    }

    fun steps(manufacturer: String): List<String> = when (brand(manufacturer)) {
        "vivo" -> listOf(
            "Open Settings, then Battery, then Background power consumption management, and set Flow to Allow high background power consumption.",
            "In i Manager or Settings, open App manager, then Autostart, and turn Flow on.",
            "Open Flow in the recent apps list and use the lock option so it is not cleared.",
        )
        "xiaomi" -> listOf(
            "Open Settings, then Apps, then Manage apps, then Flow, and turn Autostart on.",
            "Under Battery saver for Flow, choose No restrictions.",
            "In the recent apps list, pull Flow's card down and tap the lock icon.",
        )
        "oppo" -> listOf(
            "Open Settings, then Battery, then Flow, and allow background activity.",
            "Open Settings, then Apps, then Auto launch, and turn Flow on.",
            "In the recent apps list, lock Flow's card.",
        )
        "samsung" -> listOf(
            "Open Settings, then Battery, then Background usage limits, and make sure Flow is not under Sleeping or Deep sleeping apps.",
            "Open Settings, then Apps, then Flow, then Battery, and choose Unrestricted.",
        )
        "huawei" -> listOf(
            "Open Settings, then Apps, then App launch, turn off Manage automatically for Flow, and turn on Auto-launch, Secondary launch and Run in background.",
        )
        else -> listOf(
            "Open Settings, then Apps, then Flow, then Battery, and choose Unrestricted (or Don't optimize).",
            "If your phone has an Autostart or Background activity list, turn Flow on there.",
        )
    }

    const val WHY = "Phone makers close background apps to save battery. If Flow's floating mic keeps disappearing, " +
        "allow it to run in the background. Flow only uses the microphone while you are dictating."
}
