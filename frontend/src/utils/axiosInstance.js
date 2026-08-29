import axios from "axios";
import { BASE_URL } from "./constants";
import {
    clearAccessToken,
    getAccessToken,
    getRefreshLockName,
    hasCrossTabCoordination,
    publishAccessToken,
    publishRefreshFailure,
    setAccessToken,
    waitForCrossTabAccessToken,
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
    timeout: 30000,
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
                publishRefreshFailure();
                throw error;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
};

const coordinateRefresh = async (failedToken) => {
    if (getAccessToken() && getAccessToken() !== failedToken) {
        return { accessToken: getAccessToken() };
    }

    if (!hasCrossTabCoordination()) {
        return refreshAccessToken();
    }

    return navigator.locks.request(getRefreshLockName(), { ifAvailable: true }, async (lock) => {
        if (!lock) {
            return { accessToken: await waitForCrossTabAccessToken() };
        }

        if (getAccessToken() && getAccessToken() !== failedToken) {
            return { accessToken: getAccessToken() };
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
        const failedToken = getAccessToken();
        const { accessToken: refreshedToken } = await coordinateRefresh(failedToken);
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
