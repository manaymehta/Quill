import axios from "axios";
import { BASE_URL } from "./constants";
import {
    clearAccessToken,
    getAccessToken,
    getRefreshLockName,
    hasCrossTabCoordination,
    hasRecentRefreshFailure,
    publishAccessToken,
    publishRefreshFailure,
    setAccessToken,
} from "./authSession";

const axiosInstance = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    withCredentials: true,
    headers: {
        "Content-Type": "application/json",
    },
});

axiosInstance.interceptors.request.use((config) => {
    const accessToken = getAccessToken();
    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

const refreshClient = axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    withCredentials: true,
    headers: {
        "Content-Type": "application/json",
    },
});

let refreshPromise = null;

const isAuthRequest = (url = "") => [
    "/login",
    "/create-account",
    "/auth/google",
    "/auth/refresh",
    "/auth/logout",
].some((path) => url.endsWith(path));

const refreshAccessToken = async () => {
    if (!refreshPromise) {
        refreshPromise = refreshClient.post("/auth/refresh")
            .then(({ data }) => {
                if (!data?.accessToken) throw new Error("Refresh response did not include an access token");
                setAccessToken(data.accessToken);
                publishAccessToken(data.accessToken);
                return data;
            })
            .catch((error) => {
                publishRefreshFailure(error);
                throw error;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
};

const coordinateRefresh = async (failedToken) => {
    // 1. If another request already refreshed the access token in memory, return it immediately.
    if (getAccessToken() && getAccessToken() !== failedToken) {
        return { accessToken: getAccessToken() };
    }

    // 2. Intra-tab deduplication: If THIS tab already has a refresh in flight, reuse it!
    // All concurrent requests in the same tab share one single network call.
    if (refreshPromise) {
        const data = await refreshPromise;
        return { accessToken: data?.accessToken || getAccessToken() };
    }

    // 3. If a refresh recently failed across any tab, reject immediately without redundant network calls.
    if (hasRecentRefreshFailure()) {
        throw new Error("Session refresh recently failed");
    }

    // 4. Fallback if cross-tab coordination is unavailable
    if (!hasCrossTabCoordination()) {
        return refreshAccessToken();
    }

    // 5. Cross-tab coordination via Web Locks
    return navigator.locks.request(getRefreshLockName(), async () => {
        // Re-check: did another tab refresh the token while we were waiting for the lock?
        if (getAccessToken() && getAccessToken() !== failedToken) {
            return { accessToken: getAccessToken() };
        }

        // Re-check: is an in-flight refresh promise active in this tab?
        if (refreshPromise) {
            const data = await refreshPromise;
            return { accessToken: data?.accessToken || getAccessToken() };
        }

        // Re-check: did another tab fail the refresh while we were waiting?
        if (hasRecentRefreshFailure()) {
            throw new Error("Session refresh recently failed in another tab");
        }

        return refreshAccessToken();
    });
};

axiosInstance.interceptors.response.use((response) => response, async (error) => {
    const originalRequest = error.config;
    if (
        error.response?.status !== 401
        || !originalRequest
        || originalRequest._retry
        || originalRequest._skipAuthRefresh
        || isAuthRequest(originalRequest.url)
    ) {
        return Promise.reject(error);
    }

    originalRequest._retry = true;
    try {
        const authHeader = originalRequest.headers?.Authorization
            || originalRequest.headers?.authorization
            || (typeof originalRequest.headers?.get === "function" ? originalRequest.headers.get("Authorization") : null);
        const failedToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : (getAccessToken() || null);

        const refreshResult = await coordinateRefresh(failedToken);
        const refreshedToken = refreshResult?.accessToken || getAccessToken();

        if (!refreshedToken) {
            throw new Error("Unable to obtain refreshed access token");
        }

        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${refreshedToken}`;
        return axiosInstance(originalRequest);
    } catch (refreshError) {
        clearAccessToken();
        if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("auth:expired"));
        }
        return Promise.reject(refreshError);
    }
});

export default axiosInstance;
