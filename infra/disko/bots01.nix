{ ... }:
{
  disko.devices = {
    disk.main = {
      # replace with your disk (e.g. /dev/disk/by-id/<id>)
      device = "/dev/disk/by-id/CHANGE_ME";
      type = "disk";
      content = {
        type = "gpt";
        partitions = {
          bios = {
            size = "1M";
            type = "EF02";
          };
          root = {
            size = "100%";
            content = {
              type = "filesystem";
              format = "ext4";
              mountpoint = "/";
            };
          };
        };
      };
    };
  };
}
