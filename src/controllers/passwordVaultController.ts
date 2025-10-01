import { Request, Response } from 'express';
import { db } from '../db/index';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.VAULT_ENCRYPTION_KEY || 'default-32-char-key-change-me!!';
const IV_LENGTH = 16;

class PasswordVaultController {
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
      iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(text: string): string {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
      iv
    );
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async createPassword(req: Request, res: Response) {
    try {
      const {
        title,
        username,
        email,
        password,
        url,
        notes,
        category,
        icon,
        userId = '00000000-0000-0000-0000-000000000001'
      } = req.body;

      if (!title || !password) {
        return res.status(400).json({ error: 'Title and password are required' });
      }

      const encryptedPassword = this.encrypt(password);

      const result = await db.query(
        `INSERT INTO password_vault 
         (user_id, title, username, email, password_encrypted, url, notes, category, icon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, title, username, email, url, notes, category, icon, is_favorite, created_at, updated_at`,
        [userId, title, username, email, encryptedPassword, url, notes, category || 'general', icon || '🔐']
      );

      res.json({ password: result.rows[0] });
    } catch (error) {
      console.error('Error creating password:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getPasswords(req: Request, res: Response) {
    try {
      const userId = req.query.userId || '00000000-0000-0000-0000-000000000001';
      const category = req.query.category;

      let query = `
        SELECT id, title, username, email, url, notes, category, icon, is_favorite, created_at, updated_at
        FROM password_vault
        WHERE user_id = $1
      `;
      const params: any[] = [userId];

      if (category) {
        query += ' AND category = $2';
        params.push(category);
      }

      query += ' ORDER BY is_favorite DESC, created_at DESC';

      const result = await db.query(query, params);
      res.json({ passwords: result.rows });
    } catch (error) {
      console.error('Error fetching passwords:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getPassword(req: Request, res: Response) {
    try {
      const { passwordId } = req.params;
      const userId = '00000000-0000-0000-0000-000000000001';

      const result = await db.query(
        `SELECT * FROM password_vault WHERE id = $1 AND user_id = $2`,
        [passwordId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Password not found' });
      }

      const passwordData = result.rows[0];
      const decryptedPassword = this.decrypt(passwordData.password_encrypted);

      res.json({
        password: {
          ...passwordData,
          password: decryptedPassword,
          password_encrypted: undefined
        }
      });
    } catch (error) {
      console.error('Error fetching password:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updatePassword(req: Request, res: Response) {
    try {
      const { passwordId } = req.params;
      const { title, username, email, password, url, notes, category, icon, isFavorite } = req.body;
      const userId = '00000000-0000-0000-0000-000000000001';

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (title !== undefined) {
        updates.push(`title = $${paramCount}`);
        values.push(title);
        paramCount++;
      }

      if (username !== undefined) {
        updates.push(`username = $${paramCount}`);
        values.push(username);
        paramCount++;
      }

      if (email !== undefined) {
        updates.push(`email = $${paramCount}`);
        values.push(email);
        paramCount++;
      }

      if (password !== undefined) {
        const encryptedPassword = this.encrypt(password);
        updates.push(`password_encrypted = $${paramCount}`);
        values.push(encryptedPassword);
        paramCount++;
      }

      if (url !== undefined) {
        updates.push(`url = $${paramCount}`);
        values.push(url);
        paramCount++;
      }

      if (notes !== undefined) {
        updates.push(`notes = $${paramCount}`);
        values.push(notes);
        paramCount++;
      }

      if (category !== undefined) {
        updates.push(`category = $${paramCount}`);
        values.push(category);
        paramCount++;
      }

      if (icon !== undefined) {
        updates.push(`icon = $${paramCount}`);
        values.push(icon);
        paramCount++;
      }

      if (isFavorite !== undefined) {
        updates.push(`is_favorite = $${paramCount}`);
        values.push(isFavorite);
        paramCount++;
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
      }

      updates.push(`updated_at = NOW()`);
      values.push(passwordId, userId);

      const result = await db.query(
        `UPDATE password_vault 
         SET ${updates.join(', ')}
         WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
         RETURNING id, title, username, email, url, notes, category, icon, is_favorite, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Password not found' });
      }

      res.json({ password: result.rows[0] });
    } catch (error) {
      console.error('Error updating password:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async deletePassword(req: Request, res: Response) {
    try {
      const { passwordId } = req.params;
      const userId = '00000000-0000-0000-0000-000000000001';

      const result = await db.query(
        'DELETE FROM password_vault WHERE id = $1 AND user_id = $2 RETURNING *',
        [passwordId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Password not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting password:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const passwordVaultController = new PasswordVaultController();