// https://developer.scrypted.app/#getting-started
// package.json contains the metadata (name, interfaces) about this device
// under the "scrypted" key.
import crypto from "crypto";
import SunCalc from "suncalc";

import sdk, { BinarySensor, DeviceCreator, DeviceCreatorSettings, DeviceProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Settings, Setting, SettingValue, ScryptedDevice, PositionSensor, EventListenerRegister } from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings";

const { deviceManager } = sdk;

class SunriseSunsetSensor extends ScryptedDeviceBase implements BinarySensor, Settings {
    storageSettings = new StorageSettings(this, {
        linkedPositionSensor: {
            title: 'Linked PositionSensor',
            description: 'The position sensor linked with this sunrise-sunset sensor for geolocation data.',
            value: this.storage.getItem('linkedPositionSensor'),
            deviceFilter: `interfaces.includes('${ScryptedInterface.PositionSensor}')`,
            type: 'device',
        },
        mode: {
            title: 'Mode',
            value: this.storage.getItem('mode'),
            choices: ['sunrise', 'sunset'],
        }
    });

    positionListener: EventListenerRegister;
    startTimeout: NodeJS.Timeout;
    endTimeout: NodeJS.Timeout;

    constructor(nativeId: string) {
        super(nativeId);
        this.setupSensor();
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
        this.setupSensor();
    }

    setupSensor(): Promise<void> {
        this.release();

        if (!this.storageSettings.values.linkedPositionSensor || !this.storageSettings.values.mode) {
            return;
        }

        const positionSensor = this.storageSettings.values.linkedPositionSensor as ScryptedDevice & PositionSensor;
        this.positionListener = positionSensor.listen(ScryptedInterface.PositionSensor, () => this.setupSensor());

        // due to odd timezone behavior, we are calculating solar values for multiple days
        // to ensure the next event can be calculated properly
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const tomorrowMidnight = new Date(todayMidnight);
        tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
        const dayAfterTomorrowMidnight = new Date(tomorrowMidnight);
        dayAfterTomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);

        const todayTimes = SunCalc.getTimes(todayMidnight, positionSensor.position.latitude, positionSensor.position.longitude);
        const tomorrowTimes = SunCalc.getTimes(tomorrowMidnight, positionSensor.position.latitude, positionSensor.position.longitude);
        const dayAfterTomorrowTimes = SunCalc.getTimes(dayAfterTomorrowMidnight, positionSensor.position.latitude, positionSensor.position.longitude);

        if (this.storageSettings.values.mode == "sunrise") {
            this.doSunrise(todayTimes) || this.doSunrise(tomorrowTimes) || this.doSunrise(dayAfterTomorrowTimes);
        } else {
            this.doSunset(todayTimes) || this.doSunset(tomorrowTimes) || this.doSunrise(dayAfterTomorrowTimes);
        }
    }

    release(): void {
        this.positionListener?.removeListener();
        clearTimeout(this.startTimeout);
        clearTimeout(this.endTimeout);
    }

    doSunrise(times: SunCalc.GetTimesResult): boolean {
        const now = Date.now();
        let hasEvent = false;
        if (times.sunrise.getTime() > now) {
            const delay = times.sunrise.getTime() - now;
            this.console.log(`Next sunrise start will be ${new Date(Date.now() + delay)}`);
            this.startTimeout = setTimeout(() => this.trigger(), delay);
            hasEvent = true;
        }
        if (times.sunriseEnd.getTime() > now) {
            const delay = times.sunriseEnd.getTime() - now;
            this.console.log(`Next sunrise end will be ${new Date(Date.now() + delay)}`);
            this.endTimeout = setTimeout(() => this.untrigger(), delay);
            hasEvent = true;
        }
        return hasEvent;
    }

    doSunset(times: SunCalc.GetTimesResult): boolean {
        const now = Date.now();
        let hasEvent = false;
        if (times.sunsetStart.getTime() > now) {
            const delay = times.sunsetStart.getTime() - now;
            this.console.log(`Nest sunset start will be ${new Date(Date.now() + delay)}`);
            this.startTimeout = setTimeout(() => this.trigger(), delay);
            hasEvent = true;
        }
        if (times.sunset.getTime() > now) {
            const delay = times.sunset.getTime() - now;
            this.console.log(`Next sunset end will be ${new Date(Date.now() + delay)}`);
            this.endTimeout = setTimeout(() => this.untrigger(), delay);
            hasEvent = true;
        }
        return hasEvent;
    }

    trigger(): void {
        this.binaryState = true;
    }

    untrigger(): void {
        this.binaryState = false;
        this.setupSensor();
    }
}

class SunriseSunsetPlugin extends ScryptedDeviceBase implements DeviceCreator, DeviceProvider {
    devices: Map<string, SunriseSunsetSensor>

    constructor(nativeId?: string) {
        super(nativeId);
        this.devices = new Map<string, SunriseSunsetSensor>();
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                title: "Name",
                key: "name"
            },
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const uuid = crypto.randomUUID();
        const name = settings.name?.toString() || "New Sunrise-Sunset Sensor";
        await deviceManager.onDeviceDiscovered({
            nativeId: uuid,
            name,
            interfaces: [
                ScryptedInterface.BinarySensor,
                ScryptedInterface.Settings,
            ],
            type: ScryptedDeviceType.Sensor,
        })
        await this.getDevice(uuid);
        return uuid;
    }

    async getDevice(nativeId: string): Promise<SunriseSunsetSensor> {
        if (this.devices.has(nativeId)) {
            return this.devices.get(nativeId);
        }
        const device = new SunriseSunsetSensor(nativeId);
        this.devices.set(nativeId, device);
        return device;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.devices.delete(nativeId);
    }
}

export default SunriseSunsetPlugin;
