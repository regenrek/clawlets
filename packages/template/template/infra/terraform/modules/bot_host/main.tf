terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.50.0"
    }
  }
}

variable "name" {
  type = string
}

variable "location" {
  type = string
  default = "nbg1"
}

variable "server_type" {
  type = string
  default = "cx43"
}

variable "image" {
  type = string
  default = "debian-12"
}

variable "admin_cidr" {
  type = string
}

variable "ssh_key_id" {
  type = string
}

variable "bootstrap_ssh" {
  type = bool
  default = true
}

variable "wireguard_port" {
  type = string
  default = "51820"
}

resource "hcloud_firewall" "fw" {
  name = "${var.name}-fw"

  rule {
    direction   = "in"
    protocol    = "udp"
    port        = var.wireguard_port
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "WireGuard"
  }

  dynamic "rule" {
    for_each = var.bootstrap_ssh ? [1] : []
    content {
      direction   = "in"
      protocol    = "tcp"
      port        = "22"
      source_ips  = [var.admin_cidr]
      description = "Bootstrap SSH from admin CIDR"
    }
  }
}

resource "hcloud_server" "vm" {
  name        = var.name
  server_type = var.server_type
  location    = var.location
  image       = var.image

  ssh_keys     = [var.ssh_key_id]
  firewall_ids = [hcloud_firewall.fw.id]
}

output "ipv4" {
  value = hcloud_server.vm.ipv4_address
}
