import React, { useState, useEffect, useRef } from 'react';

// Main App component
const App = () => {
    const [prayerTimes, setPrayerTimes] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentDate, setCurrentDate] = useState('');
    const [locationName, setLocationName] = useState('Riyadh, Saudi Arabia'); // Displayed location
    const [cityInput, setCityInput] = useState('');
    const [countryInput, setCountryInput] = useState('');
    const [notificationPermission, setNotificationPermission] = useState(Notification.permission);

    // Using useRef to store the timeout ID so it persists across renders
    const nextPrayerTimeoutRef = useRef(null);

    // Default coordinates and calculation method
    const defaultCity = 'Riyadh';
    const defaultCountry = 'Saudi Arabia';
    const calculationMethod = 4; // Umm Al-Qura University, Makkah

    /**
     * Fetches prayer times from the Aladhan API.
     * Prioritizes city/country input, then geolocation, then defaults to Riyadh.
     * @param {string} city - The city name.
     * @param {string} country - The country name.
     * @param {number} lat - Latitude for geolocation.
     * @param {number} lon - Longitude for geolocation.
     */
    const fetchPrayerTimes = async (city, country, lat, lon) => {
        setLoading(true);
        setError(null);
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const formattedDate = `${day}-${month}-${year}`; // For timingsByCoordinates
            setCurrentDate(formattedDate);

            let apiUrl;
            let resolvedLocationName;

            if (city && country) {
                // Use city and country if provided
                apiUrl = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=${calculationMethod}`;
                resolvedLocationName = `${city}, ${country}`;
            } else if (lat && lon) {
                // Use latitude and longitude if provided (from geolocation)
                apiUrl = `https://api.aladhan.com/v1/timings/${formattedDate}?latitude=${lat}&longitude=${lon}&method=${calculationMethod}`;
                resolvedLocationName = `Your Current Location (Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(2)})`;
            } else {
                // Fallback to default city/country
                apiUrl = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(defaultCity)}&country=${encodeURIComponent(defaultCountry)}&method=${calculationMethod}`;
                resolvedLocationName = `${defaultCity}, ${defaultCountry}`;
            }

            const response = await fetch(apiUrl);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.code === 200 && data.status === 'OK') {
                setPrayerTimes(data.data.timings);
                setLocationName(resolvedLocationName); // Update displayed location
            } else {
                throw new Error(data.data ? data.data.message : 'Failed to fetch prayer times.');
            }
        } catch (e) {
            console.error("Error fetching prayer times:", e);
            setError(`Failed to load prayer times: ${e.message}. Please try again.`);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Handles fetching prayer times based on user-entered city and country.
     */
    const handleLocationSearch = () => {
        if (cityInput && countryInput) {
            fetchPrayerTimes(cityInput, countryInput, null, null);
        } else {
            setError("Please enter both city and country for search.");
        }
    };

    /**
     * Requests geolocation and fetches prayer times based on current position.
     */
    const handleGeolocation = () => {
        setLoading(true);
        setError(null);
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    fetchPrayerTimes(null, null, latitude, longitude);
                },
                (geoError) => {
                    // Log the full geoError object for better debugging
                    // Explicitly log code and message as the object itself might appear empty in some console environments.
                    console.error("Geolocation error:", geoError.code, geoError.message, geoError);
                    let errorMessage = "Unable to retrieve your location.";
                    if (geoError.code === geoError.PERMISSION_DENIED) {
                        errorMessage = "Location access denied. Please enable it in your browser settings.";
                    } else if (geoError.code === geoError.POSITION_UNAVAILABLE) {
                        errorMessage = "Location information is unavailable.";
                    } else if (geoError.code === geoError.TIMEOUT) {
                        errorMessage = "The request to get user location timed out.";
                    }
                    // If geoError has a message property, use it for more specific feedback
                    if (geoError.message) {
                        errorMessage += ` (${geoError.message})`;
                    }
                    setError(errorMessage);
                    setLoading(false);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        } else {
            setError("Geolocation is not supported by your browser.");
            setLoading(false);
        }
    };

    /**
     * Requests notification permission from the user.
     */
    const requestNotificationPermission = async () => {
        if (!('Notification' in window)) {
            setError("This browser does not support desktop notifications.");
            return;
        }

        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);

        if (permission === 'granted' && prayerTimes) {
            scheduleNotifications(prayerTimes);
        } else if (permission === 'denied') {
            setError("Notification permission denied. You will not receive prayer time alerts.");
        }
    };

    /**
     * Schedules browser notifications for upcoming prayer times.
     * Notifications will only appear if the browser tab is open.
     * @param {object} times - The prayer times object.
     */
    const scheduleNotifications = (times) => {
        // Clear any existing timeouts to prevent duplicate notifications
        if (nextPrayerTimeoutRef.current) {
            clearTimeout(nextPrayerTimeoutRef.current);
        }

        if (notificationPermission !== 'granted') {
            console.warn("Notification permission not granted. Cannot schedule notifications.");
            return;
        }

        const now = new Date();
        const today = now.toLocaleDateString('en-CA'); //YYYY-MM-DD format for date parsing

        let closestPrayerTime = null;
        let minDiff = Infinity;

        // Relevant prayer names for notifications
        const relevantPrayerNames = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

        // Create Date objects for each relevant prayer time today
        const prayerTimeDates = Object.entries(times)
            .filter(([name]) => relevantPrayerNames.includes(name))
            .map(([name, time24]) => {
                const [hours, minutes] = time24.split(':');
                const prayerDate = new Date(`${today}T${hours}:${minutes}:00`);
                return { name, time: prayerDate };
            })
            .sort((a, b) => a.time.getTime() - b.time.getTime()); // Sort by time

        // Find the next upcoming prayer for today
        for (const prayer of prayerTimeDates) {
            const diff = prayer.time.getTime() - now.getTime();
            if (diff > 0 && diff < minDiff) {
                minDiff = diff;
                closestPrayerTime = prayer;
            }
        }

        if (closestPrayerTime) {
            console.log(`Scheduling notification for ${closestPrayerTime.name} in ${minDiff / 1000} seconds.`);
            nextPrayerTimeoutRef.current = setTimeout(() => {
                new Notification(`Prayer Time: ${closestPrayerTime.name}`, {
                    body: `It's time for ${closestPrayerTime.name} prayer!`,
                    icon: 'https://placehold.co/48x48/00CED1/FFFFFF?text=P' // Placeholder icon
                });
                // After this notification, re-evaluate and schedule the next one (e.g., for the next prayer or next day's Fajr)
                // For simplicity, we'll just log here. A more robust solution would re-call scheduleNotifications after a delay
                // or after the current prayer has passed to find the next one.
                // For now, after a notification, the user would need to refresh or interact to re-trigger scheduling for subsequent prayers.
            }, minDiff);
        } else {
            console.log("No upcoming prayer times today to schedule notifications for. Scheduling for Fajr tomorrow.");
            // If no more prayers today, schedule for Fajr tomorrow
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowFormatted = tomorrow.toLocaleDateString('en-CA');

            const fajrTimeToday = prayerTimeDates.find(p => p.name === 'Fajr')?.time;
            if (fajrTimeToday) {
                const [fajrHours, fajrMinutes] = fajrTimeToday.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }).split(':');
                const fajrTomorrow = new Date(`${tomorrowFormatted}T${fajrHours}:${fajrMinutes}:00`);
                const diffToTomorrowFajr = fajrTomorrow.getTime() - now.getTime();

                if (diffToTomorrowFajr > 0) {
                    console.log(`Scheduling notification for Fajr tomorrow in ${diffToTomorrowFajr / 1000} seconds.`);
                    nextPrayerTimeoutRef.current = setTimeout(() => {
                        new Notification(`Prayer Time: Fajr`, {
                            body: `It's time for Fajr prayer tomorrow!`,
                            icon: 'https://placehold.co/48x48/00CED1/FFFFFF?text=P'
                        });
                        // After notification, re-fetch or re-calculate for the new day
                    }, diffToTomorrowFajr);
                }
            }
        }
    };

    // Initial fetch on component mount
    useEffect(() => {
        fetchPrayerTimes(defaultCity, defaultCountry, null, null);
    }, []);

    // Schedule notifications whenever prayerTimes or notificationPermission changes
    useEffect(() => {
        if (prayerTimes && notificationPermission === 'granted') {
            scheduleNotifications(prayerTimes);
        }
    }, [prayerTimes, notificationPermission]); // Depend on prayerTimes and notificationPermission

    // Helper function to format time (e.g., "05:30" to "5:30 AM")
    const formatTime = (time24) => {
        if (!time24) return '';
        const [hours, minutes] = time24.split(':');
        const hour = parseInt(hours, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const formattedHour = hour % 12 === 0 ? 12 : hour % 12;
        return `${formattedHour}:${minutes} ${ampm}`;
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 to-indigo-900 text-white font-inter flex flex-col items-center justify-center p-4">
            <div className="bg-white bg-opacity-10 backdrop-filter backdrop-blur-lg rounded-3xl shadow-2xl p-6 md:p-8 w-full max-w-md border border-white border-opacity-20 mb-6">
                <h1 className="text-3xl md:text-4xl font-bold text-center mb-4 text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-blue-400">
                    Prayer Times
                </h1>
                <p className="text-center text-lg mb-2 text-gray-200">
                    {currentDate}
                </p>
                <p className="text-center text-xl font-semibold mb-6 text-blue-300">
                    {locationName}
                </p>

                {/* Location Search Input */}
                <div className="mb-6 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <input
                            type="text"
                            placeholder="City (e.g., London)"
                            className="flex-1 p-3 rounded-xl bg-white bg-opacity-20 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            value={cityInput}
                            onChange={(e) => setCityInput(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="Country (e.g., UK)"
                            className="flex-1 p-3 rounded-xl bg-white bg-opacity-20 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            value={countryInput}
                            onChange={(e) => setCountryInput(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <button
                            onClick={handleLocationSearch}
                            className="flex-1 bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
                        >
                            Search Location
                        </button>
                        <button
                            onClick={handleGeolocation}
                            className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
                        >
                            Use My Location
                        </button>
                    </div>
                </div>

                {/* Notification Button */}
                <div className="mb-6 text-center">
                    {notificationPermission === 'default' && (
                        <button
                            onClick={requestNotificationPermission}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 ease-in-out transform hover:scale-105 w-full"
                        >
                            Enable Notifications
                        </button>
                    )}
                    {notificationPermission === 'granted' && (
                        <p className="text-green-300 text-sm">Notifications are enabled.</p>
                    )}
                    {notificationPermission === 'denied' && (
                        <p className="text-red-300 text-sm">Notifications are blocked. Please enable them in browser settings.</p>
                    )}
                </div>

                {loading && (
                    <div className="text-center text-lg text-blue-300">Loading prayer times...</div>
                )}

                {error && (
                    <div className="text-center text-lg text-red-400">{error}</div>
                )}

                {!loading && !error && prayerTimes && (
                    <div className="space-y-4">
                        {Object.entries(prayerTimes).map(([name, time]) => (
                            // Filter out unnecessary timings like 'Sunrise', 'Sunset', 'Imsak', 'Midnight', 'Firstthird', 'Lastthird'
                            !['Sunrise', 'Sunset', 'Imsak', 'Midnight', 'Firstthird', 'Lastthird', 'Lastthird'].includes(name) && (
                                <div
                                    key={name}
                                    className="flex justify-between items-center bg-white bg-opacity-15 rounded-xl p-4 shadow-md transition-all duration-300 hover:bg-opacity-25"
                                >
                                    <span className="text-xl font-semibold text-gray-100">{name}</span>
                                    <span className="text-2xl font-bold text-teal-200">{formatTime(time)}</span>
                                </div>
                            )
                        ))}
                    </div>
                )}

                <p className="text-center text-sm text-gray-400 mt-8">
                    Data provided by Aladhan API.
                </p>
            </div>
        </div>
    );
};

export default App;

