/**
 * @jest-environment node
 */

import os from "node:os";
import { selectLanIp } from "@/app/api/presenter-remote/network-info/route";

describe("selectLanIp", () => {
  it("prefers a private LAN address on a primary interface over virtual adapters", () => {
    const interfaces = {
      bridge100: [{
        address: "172.18.0.1",
        netmask: "255.255.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "172.18.0.1/16",
      }],
      en0: [{
        address: "192.168.1.55",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "11:11:11:11:11:11",
        internal: false,
        cidr: "192.168.1.55/24",
      }],
    } as ReturnType<typeof os.networkInterfaces>;

    expect(selectLanIp(interfaces)).toBe("192.168.1.55");
  });

  it("returns null when there is no usable external IPv4 address", () => {
    const interfaces = {
      lo0: [{
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      }],
      en0: [{
        address: "169.254.12.34",
        netmask: "255.255.0.0",
        family: "IPv4",
        mac: "11:11:11:11:11:11",
        internal: false,
        cidr: "169.254.12.34/16",
      }],
    } as ReturnType<typeof os.networkInterfaces>;

    expect(selectLanIp(interfaces)).toBeNull();
  });
});